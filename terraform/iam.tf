data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "kms_policy" {
  name        = "${var.name}-kms-decrypt-policy"
  description = "IAM policy for ${var.name} to decrypt using KMS key"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Effect   = "Allow"
        Resource = data.aws_kms_key.mainnet.arn
      }
    ]
  })
}

resource "aws_iam_policy" "test_kms_policy" {
  name        = "${var.name}-kms-decrypt-policy-test"
  description = "IAM policy for ${var.name} to decrypt using TEST KMS key"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Effect   = "Allow"
        Resource = data.aws_kms_key.testnet.arn
      }
    ]
  })
}

