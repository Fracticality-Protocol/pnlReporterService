data "aws_kms_key" "testnet" {
  key_id = "alias/TEST_PNL_REPORTER"
}

data "aws_kms_key" "mainnet" {
  key_id = "alias/PNL_REPORTER"
}