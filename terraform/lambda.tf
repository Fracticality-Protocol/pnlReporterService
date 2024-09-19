locals {
  db_schema      = var.environment == "main" ? "main" : "test"
  aws_kms_key_id = var.environment == "main" ? data.aws_kms_key.mainnet.id : data.aws_kms_key.testnet.id
  api_key        = var.environment == "main" ? data.aws_secretsmanager_secret_version.endpoint.secret_string : data.aws_secretsmanager_secret_version.test_endpoint.secret_string

  percentage_trigger_change      = 0.25
  time_period_for_contract_write = 600
  operation_mode                 = "PUSH"
  key_mode                       = "KMS"
}

resource "aws_lambda_function" "default" {
  function_name    = var.name
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  role             = aws_iam_role.default.arn
  filename         = "${path.module}/../dist/bundle.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/bundle.zip")
  timeout          = 300

  environment {
    variables = {
      RPC_URL                        = var.rpc_url
      VAULT_ADDRESS                  = var.vault_address
      DB_USER                        = local.db_username
      DB_PASSWORD                    = local.db_password
      DB_HOST                        = data.aws_db_instance.db.address
      DB_NAME                        = var.db_name
      DB_SCHEMA                      = local.db_schema
      GET_NAV_URL                    = var.fund_db_nav_endpoint
      API_KEY                        = local.api_key
      AWS_KMS_KEY_ID                 = local.aws_kms_key_id
      PERCENTAGE_TRIGGER_CHANGE      = local.percentage_trigger_change
      TIME_PERIOD_FOR_CONTRACT_WRITE = local.time_period_for_contract_write
      OPERATION_MODE                 = local.operation_mode
      KEY_MODE                       = local.key_mode
    }
  }
}


resource "aws_iam_role" "default" {
  name               = "${var.name}-service-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_policy" {
  role       = aws_iam_role.default.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "kms_policy" {
  role       = aws_iam_role.default.name
  policy_arn = aws_iam_policy.kms_policy.arn
}
