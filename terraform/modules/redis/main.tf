locals {
  common_tags = merge(var.tags, {
    Environment = var.environment
    Project     = "stellarswipe"
    ManagedBy   = "terraform"
  })
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "stellarswipe-${var.environment}"
  subnet_ids = var.subnet_ids
  tags       = local.common_tags
}

resource "aws_security_group" "redis" {
  name        = "stellarswipe-${var.environment}-redis"
  description = "Redis security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "Redis from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_kms_key" "redis" {
  description             = "KMS key for Redis encryption - ${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = local.common_tags
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "stellarswipe-${var.environment}"
  description          = "StellarSwipe Redis - ${var.environment}"

  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_nodes
  engine_version       = var.redis_version
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn

  automatic_failover_enabled = var.num_cache_nodes > 1
  multi_az_enabled           = var.environment == "production" && var.num_cache_nodes > 1

  snapshot_retention_limit = var.environment == "production" ? 7 : 1
  snapshot_window          = "03:00-04:00"
  maintenance_window       = "mon:04:00-mon:05:00"

  tags = merge(local.common_tags, { Name = "stellarswipe-${var.environment}" })
}
