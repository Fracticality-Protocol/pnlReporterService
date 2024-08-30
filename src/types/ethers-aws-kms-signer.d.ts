// NOTE: @cuonghx.gu-tech/ethers-aws-kms-signer does not provide type definitions manually defining them here
declare module '@cuonghx.gu-tech/ethers-aws-kms-signer' {
  import { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types'
  import {
    AbstractSigner,
    Provider,
    TransactionRequest,
    TypedDataDomain,
    TypedDataField
  } from 'ethers'

  export type EthersAwsKmsSignerConfig = {
    credentials: AwsCredentialIdentityProvider | AwsCredentialIdentity
    region: string
    keyId: string
  }

  export class AwsKmsSigner<P extends null | Provider = null | Provider> extends AbstractSigner {
    constructor(config: EthersAwsKmsSignerConfig, provider?: P)
    connect(provider: Provider | null): AwsKmsSigner
    getAddress(): Promise<string>
    signTransaction(tx: TransactionRequest): Promise<string>
    signMessage(message: string | Uint8Array): Promise<string>
    signTypedData(
      domain: TypedDataDomain,
      types: Record<string, TypedDataField[]>,
      value: Record<string, any>
    ): Promise<string>
  }
}
