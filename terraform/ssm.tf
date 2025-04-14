data "aws_ssm_parameter" "mainnet_rpc_url" {
  name = "BERACHAIN_RPC_URL"
}

data "aws_ssm_parameter" "mainnet_vault_address" {
  name = "BERACHAIN_VAULT_ADDRESS"
}
