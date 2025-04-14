data "aws_secretsmanager_secret" "db" {
  name = "BERACHAIN_FRACTALITY_DB"
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = data.aws_secretsmanager_secret.db.id
}

locals {
  secret_data = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
  db_username = local.secret_data["USERNAME"]
  db_password = local.secret_data["PASSWORD"]
}

data "aws_secretsmanager_secret" "endpoint" {
  name = "BERACHAIN_FUND_DATA_INTERNAL_KEY"
}

data "aws_secretsmanager_secret_version" "endpoint" {
  secret_id = data.aws_secretsmanager_secret.endpoint.id
}

data "aws_secretsmanager_secret" "test_endpoint" {
  name = "BERACHAIN_FUND_DATA_INTERNAL_KEY_TEST"
}

data "aws_secretsmanager_secret_version" "test_endpoint" {
  secret_id = data.aws_secretsmanager_secret.test_endpoint.id
}
