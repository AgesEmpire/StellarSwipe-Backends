output "redis_endpoint" {
  value     = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive = true
}

output "redis_port" {
  value = aws_elasticache_replication_group.main.port
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
