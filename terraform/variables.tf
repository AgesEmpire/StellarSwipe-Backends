variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Must be staging or production."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 100
}

variable "db_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.3"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "stellarswipe"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.medium"
}

variable "redis_num_cache_nodes" {
  description = "Number of Redis cache nodes"
  type        = number
  default     = 2
}

variable "eks_node_desired_size" {
  description = "EKS node group desired size"
  type        = number
  default     = 3
}

variable "eks_node_min_size" {
  description = "EKS node group minimum size"
  type        = number
  default     = 2
}

variable "eks_node_max_size" {
  description = "EKS node group maximum size"
  type        = number
  default     = 10
}

variable "eks_instance_types" {
  description = "EKS node instance types"
  type        = list(string)
  default     = ["t3.large"]
}

variable "tags" {
  description = "Additional resource tags"
  type        = map(string)
  default     = {}
}
