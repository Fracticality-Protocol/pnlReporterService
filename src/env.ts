import { z } from 'zod'
import { KeyMode, OperationMode } from './modes'

const envSchema = z
  .object({
    GET_NAV_URL: z.string().url(),
    PERCENTAGE_TRIGGER_CHANGE: z.string().transform((val) => parseFloat(val)),
    TIME_PERIOD_FOR_CONTRACT_WRITE: z.string().transform((val) => parseInt(val, 10)),
    API_KEY: z.string(),
    VAULT_ADDRESS: z.string(),
    RPC_URL: z.string().url(),
    PRIVATE_KEY: z.string().optional(),
    DB_HOST: z.string(),
    DB_USER: z.string(),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string(),
    DB_PORT: z.string().optional(),
    DB_SCHEMA: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_KMS_KEY_ID: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    OPERATION_MODE: z.nativeEnum(OperationMode).default(OperationMode.PULL),
    KEY_MODE: z.nativeEnum(KeyMode).default(KeyMode.KMS)
  })
  .refine((data) => data.PRIVATE_KEY || data.AWS_KMS_KEY_ID, {
    message: 'Either PRIVATE_KEY or AWS_KMS_KEY_ID must be set',
    path: ['PRIVATE_KEY', 'AWS_KMS_KEY_ID']
  })
  .refine(
    (data) => {
      if (data.AWS_KMS_KEY_ID) {
        return data.AWS_REGION && data.AWS_ACCESS_KEY_ID && data.AWS_SECRET_ACCESS_KEY
      }
      return true
    },
    {
      message:
        'If AWS_KMS_KEY_ID is set, AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY must also be set',
      path: ['AWS_KMS_KEY_ID']
    }
  )

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  const formattedErrors = parsedEnv.error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message
  }))

  console.error('Environment variable validation failed:', formattedErrors)
  throw new Error('Invalid environment variables.')
}

export type ReporterEnv = z.infer<typeof envSchema>

export const env = parsedEnv.data
