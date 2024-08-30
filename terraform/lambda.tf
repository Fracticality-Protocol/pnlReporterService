resource "aws_lambda_function" "default" {
  function_name    = var.name
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  role             = aws_iam_role.default.arn
  filename         = "${path.module}/../dist/bundle.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/bundle.zip")

  environment {
    variables = {
      RPC_URL                        = var.rpc_url
      VAULT_ADDRESS                  = var.vault_address
      DB_USER                        = local.db_username
      DB_PASSWORD                    = local.db_password
      DB_HOST                        = aws_db_instance.db.address
      DB_NAME                        = var.db_name
      GET_NAV_URL                    = var.fund_db_nav_endpoint
      API_KEY                        = data.aws_secretsmanager_secret_version.endpoint.secret_string
      AWS_KMS_KEY_ID                 = data.aws_kms_key.testnet.id
      PERCENTAGE_TRIGGER_CHANGE      = 0.25
      TIME_PERIOD_FOR_CONTRACT_WRITE = 600
      OPERATION_MODE                 = "PUSH"
      KEY_MODE                       = "KMS"
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
