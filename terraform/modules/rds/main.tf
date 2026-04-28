locals {
  common_tags = merge(var.tags, {
    Environment = var.environment
    Project     = "stellarswipe"
    ManagedBy   = "terraform"
  })
}

resource "aws_db_subnet_group" "main" {
  name       = "stellarswipe-${var.environment}"
  subnet_ids = var.subnet_ids
  tags       = merge(local.common_tags, { Name = "stellarswipe-${var.environment}-db-subnet-group" })
}

resource "aws_security_group" "rds" {
  name        = "stellarswipe-${var.environment}-rds"
  description = "RDS security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "PostgreSQL from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_kms_key" "rds" {
  description             = "KMS key for RDS encryption - ${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = local.common_tags
}

resource "aws_db_instance" "main" {
  identifier        = "stellarswipe-${var.environment}"
  engine            = "postgres"
  engine_version    = var.engine_version
  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  multi_az               = var.environment == "production"
  deletion_protection    = var.environment == "production"
  skip_final_snapshot    = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "stellarswipe-${var.environment}-final" : null

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = merge(local.common_tags, { Name = "stellarswipe-${var.environment}" })
}
