variable "account_id" {
  type        = string
  description = "AWS account ID"
}

variable "region" {
  type        = string
  description = "AWS region"
}

variable "environment" {
  type = string
}

variable "name" {
  type = string
}

variable "project" {
  type = string
}

variable "project_version" {
  type = string
}

variable "db_host" {
  type = string
}

variable "db_name" {
  type = string
}

variable "rpc_url" {
  type = string
}

variable "vault_address" {
  type = string
}

variable "fund_db_nav_endpoint" {
  type = string
}

