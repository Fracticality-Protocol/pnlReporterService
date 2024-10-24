data "aws_kms_key" "testnet" {
  key_id = "alias/PNL_REPORTER_TEST"
}

data "aws_kms_key" "mainnet" {
  key_id = "alias/PNL_REPORTER"
}
