terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.62.0"
    }
  }
  backend "s3" {
    encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Name        = var.name
      Project     = var.project
      Environment = var.environment
      Version     = var.project_version
    }
  }
}

data "aws_caller_identity" "current" {}
