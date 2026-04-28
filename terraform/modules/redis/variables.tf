variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "node_type" {
  type    = string
  default = "cache.t3.medium"
}

variable "num_cache_nodes" {
  type    = number
  default = 2
}

variable "redis_version" {
  type    = string
  default = "7.0"
}

variable "tags" {
  type    = map(string)
  default = {}
}
