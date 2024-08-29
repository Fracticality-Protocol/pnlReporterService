data "aws_secretsmanager_secret" "db" {
  name = "FUND_DATA_DB"
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = data.aws_secretsmanager_secret.db.id
}

locals {
  secret_data = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
  db_username = local.secret_data["username"]
  db_password = local.secret_data["password"]
}

data "aws_secretsmanager_secret" "endpoint" {
  name = "FUND_DATA_INTERNAL_KEY"
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = data.aws_secretsmanager_secret.db.id
}

