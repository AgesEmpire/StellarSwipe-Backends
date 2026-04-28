###############################################################################
# StellarSwipe — Disaster Recovery Infrastructure
# Multi-region PostgreSQL replication + Redis Sentinel
#
# Primary   : us-east-1
# Secondary : eu-west-1
###############################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "stellarswipe-terraform-state"
    key            = "dr/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "stellarswipe-terraform-locks"
  }
}

# ── Provider aliases ──────────────────────────────────────────────────────────

provider "aws" {
  alias  = "primary"
  region = var.primary_region
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "primary_region" {
  description = "AWS region for the primary stack"
  default     = "us-east-1"
}

variable "secondary_region" {
  description = "AWS region for the secondary (DR) stack"
  default     = "eu-west-1"
}

variable "db_instance_class" {
  description = "RDS instance class"
  default     = "db.r6g.large"
}

variable "db_name" {
  description = "PostgreSQL database name"
  default     = "stellarswipe"
}

variable "db_username" {
  description = "PostgreSQL master username"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password"
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  default     = "cache.r6g.large"
}

variable "environment" {
  description = "Deployment environment"
  default     = "production"
}

# ── Data sources ───────────────────────────────────────────────────────────────

data "aws_vpc" "primary" {
  provider = aws.primary
  tags     = { Name = "stellarswipe-${var.environment}" }
}

data "aws_subnets" "primary_private" {
  provider = aws.primary
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.primary.id]
  }
  tags = { Tier = "private" }
}

data "aws_vpc" "secondary" {
  provider = aws.secondary
  tags     = { Name = "stellarswipe-${var.environment}-dr" }
}

data "aws_subnets" "secondary_private" {
  provider = aws.secondary
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.secondary.id]
  }
  tags = { Tier = "private" }
}

# ── KMS keys ───────────────────────────────────────────────────────────────────

resource "aws_kms_key" "rds_primary" {
  provider            = aws.primary
  description         = "StellarSwipe RDS encryption key (primary)"
  enable_key_rotation = true
  tags                = local.common_tags
}

resource "aws_kms_key" "rds_secondary" {
  provider            = aws.secondary
  description         = "StellarSwipe RDS encryption key (secondary)"
  enable_key_rotation = true
  tags                = local.common_tags
}

# ── RDS Subnet Groups ─────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "primary" {
  provider   = aws.primary
  name       = "stellarswipe-${var.environment}-primary"
  subnet_ids = data.aws_subnets.primary_private.ids
  tags       = local.common_tags
}

resource "aws_db_subnet_group" "secondary" {
  provider   = aws.secondary
  name       = "stellarswipe-${var.environment}-secondary"
  subnet_ids = data.aws_subnets.secondary_private.ids
  tags       = local.common_tags
}

# ── RDS Parameter Group ───────────────────────────────────────────────────────

resource "aws_db_parameter_group" "postgres" {
  provider = aws.primary
  name     = "stellarswipe-${var.environment}-postgres16"
  family   = "postgres16"

  # Enable WAL archiving for PITR
  parameter {
    name  = "wal_level"
    value = "replica"
  }
  parameter {
    name  = "archive_mode"
    value = "on"
  }
  parameter {
    name  = "archive_command"
    value = "aws s3 cp %p s3://stellarswipe-dr-backups/wal/%f"
  }
  parameter {
    name  = "max_wal_senders"
    value = "10"
  }
  parameter {
    name  = "wal_keep_size"
    value = "2048"   # 2 GB
  }
  parameter {
    name  = "hot_standby"
    value = "on"
  }

  tags = local.common_tags
}

# ── Primary RDS Instance (Multi-AZ) ──────────────────────────────────────────

resource "aws_db_instance" "primary" {
  provider = aws.primary

  identifier        = "stellarswipe-${var.environment}-primary"
  engine            = "postgres"
  engine_version    = "16.2"
  instance_class    = var.db_instance_class
  db_name           = var.db_name
  username          = var.db_username
  password          = var.db_password
  storage_type      = "gp3"
  allocated_storage = 100
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds_primary.arn

  multi_az               = true
  db_subnet_group_name   = aws_db_subnet_group.primary.name
  parameter_group_name   = aws_db_parameter_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds_primary.id]

  backup_retention_period   = 7
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:00-sun:05:00"
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "stellarswipe-${var.environment}-final-${formatdate("YYYY-MM-DD", timestamp())}"
  copy_tags_to_snapshot     = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  tags = merge(local.common_tags, { Role = "primary" })
}

# ── Cross-Region Read Replica (secondary) ─────────────────────────────────────

resource "aws_db_instance" "secondary_replica" {
  provider = aws.secondary

  identifier          = "stellarswipe-${var.environment}-secondary"
  replicate_source_db = aws_db_instance.primary.arn
  instance_class      = var.db_instance_class
  storage_encrypted   = true
  kms_key_id          = aws_kms_key.rds_secondary.arn

  db_subnet_group_name   = aws_db_subnet_group.secondary.name
  vpc_security_group_ids = [aws_security_group.rds_secondary.id]

  # Replica does not need its own backups — PITR is managed on the primary
  backup_retention_period = 1
  skip_final_snapshot     = true

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn

  tags = merge(local.common_tags, { Role = "replica" })

  depends_on = [aws_db_instance.primary]
}

# ── S3 Backup Bucket (Primary) with Cross-Region Replication ─────────────────

resource "aws_s3_bucket" "backups_primary" {
  provider = aws.primary
  bucket   = "stellarswipe-dr-backups-${var.primary_region}"
  tags     = local.common_tags
}

resource "aws_s3_bucket_versioning" "backups_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.rds_primary.arn
    }
  }
}

resource "aws_s3_bucket" "backups_secondary" {
  provider = aws.secondary
  bucket   = "stellarswipe-dr-backups-${var.secondary_region}"
  tags     = local.common_tags
}

resource "aws_s3_bucket_versioning" "backups_secondary" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.backups_secondary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  provider = aws.primary
  bucket   = aws_s3_bucket.backups_primary.id
  role     = aws_iam_role.s3_replication.arn

  rule {
    id     = "replicate-all"
    status = "Enabled"

    destination {
      bucket        = aws_s3_bucket.backups_secondary.arn
      storage_class = "STANDARD_IA"

      replication_time {
        status = "Enabled"
        time   = { minutes = 15 }
      }
      metrics {
        status             = "Enabled"
        event_threshold    = { minutes = 15 }
      }
    }

    delete_marker_replication { status = "Disabled" }
  }

  depends_on = [
    aws_s3_bucket_versioning.backups_primary,
    aws_s3_bucket_versioning.backups_secondary,
  ]
}

# ── ElastiCache Redis (Sentinel / cluster mode) ───────────────────────────────

resource "aws_elasticache_replication_group" "redis_primary" {
  provider = aws.primary

  replication_group_id = "stellarswipe-${var.environment}-redis"
  description          = "StellarSwipe Redis with Sentinel HA"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2   # 1 primary + 1 replica in same region
  port                 = 6379
  engine_version       = "7.2"
  parameter_group_name = "default.redis7"

  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.primary.name
  security_group_ids = [aws_security_group.redis_primary.id]

  snapshot_retention_limit = 5
  snapshot_window          = "05:00-06:00"
  maintenance_window       = "sun:06:00-sun:07:00"

  tags = merge(local.common_tags, { Role = "primary" })
}

resource "aws_elasticache_subnet_group" "primary" {
  provider   = aws.primary
  name       = "stellarswipe-${var.environment}-redis"
  subnet_ids = data.aws_subnets.primary_private.ids
}

# ── Route 53 DNS (Failover routing policy) ───────────────────────────────────

resource "aws_route53_health_check" "api_primary" {
  fqdn              = "api-primary.stellarswipe.internal"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/v1/health"
  failure_threshold = 3
  request_interval  = 10
  tags              = merge(local.common_tags, { Name = "api-primary-health" })
}

resource "aws_route53_health_check" "api_secondary" {
  fqdn              = "api-secondary.stellarswipe.internal"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/v1/health"
  failure_threshold = 3
  request_interval  = 10
  tags              = merge(local.common_tags, { Name = "api-secondary-health" })
}

# ── IAM Roles ──────────────────────────────────────────────────────────────────

resource "aws_iam_role" "rds_monitoring" {
  name = "stellarswipe-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_iam_role" "s3_replication" {
  name = "stellarswipe-${var.environment}-s3-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "s3_replication" {
  name = "s3-replication-policy"
  role = aws_iam_role.s3_replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = [aws_s3_bucket.backups_primary.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Resource = ["${aws_s3_bucket.backups_primary.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = ["${aws_s3_bucket.backups_secondary.arn}/*"]
      }
    ]
  })
}

# ── Security groups (placeholder — attach to your VPC SGs) ───────────────────

resource "aws_security_group" "rds_primary" {
  provider    = aws.primary
  name        = "stellarswipe-${var.environment}-rds-primary"
  description = "Allow PostgreSQL from app tier"
  vpc_id      = data.aws_vpc.primary.id
  tags        = local.common_tags
}

resource "aws_security_group" "rds_secondary" {
  provider    = aws.secondary
  name        = "stellarswipe-${var.environment}-rds-secondary"
  description = "Allow PostgreSQL from app tier (DR)"
  vpc_id      = data.aws_vpc.secondary.id
  tags        = local.common_tags
}

resource "aws_security_group" "redis_primary" {
  provider    = aws.primary
  name        = "stellarswipe-${var.environment}-redis-primary"
  description = "Allow Redis from app tier"
  vpc_id      = data.aws_vpc.primary.id
  tags        = local.common_tags
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  common_tags = {
    Project     = "stellarswipe"
    Environment = var.environment
    ManagedBy   = "terraform"
    Team        = "platform"
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "primary_db_endpoint" {
  description = "Primary RDS endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "secondary_db_endpoint" {
  description = "Cross-region replica endpoint (promote this during failover)"
  value       = aws_db_instance.secondary_replica.endpoint
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.redis_primary.primary_endpoint_address
}

output "backup_bucket_primary" {
  description = "S3 backup bucket (primary region)"
  value       = aws_s3_bucket.backups_primary.bucket
}

output "backup_bucket_secondary" {
  description = "S3 backup bucket (secondary region)"
  value       = aws_s3_bucket.backups_secondary.bucket
}
