data "aws_ssm_parameter" "mainnet_rpc_url" {
  name = "MAINNET_RPC_URL"
}

data "aws_ssm_parameter" "mainnet_vault_address" {
  name = "MAINNET_VAULT_ADDRESS"
}
