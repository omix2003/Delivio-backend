/**
 * Custom error classes for payout system
 */

export class PayoutError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode: number = 500,
        public details?: any
    ) {
        super(message);
        this.name = 'PayoutError';
        Error.captureStackTrace(this, this.constructor);
    }
}

export class InsufficientBalanceError extends PayoutError {
    constructor(required: number, available: number, walletType: string) {
        super(
            `Insufficient ${walletType} wallet balance. Required: ₹${required.toFixed(2)}, Available: ₹${available.toFixed(2)}`,
            'INSUFFICIENT_BALANCE',
            400,
            { required, available, walletType, shortfall: required - available }
        );
        this.name = 'InsufficientBalanceError';
    }
}

export class PayoutAlreadyProcessedError extends PayoutError {
    constructor(payoutId: string, status: string) {
        super(
            `Payout ${payoutId} has already been ${status.toLowerCase()}`,
            'PAYOUT_ALREADY_PROCESSED',
            409,
            { payoutId, status }
        );
    }
}

export class PayoutNotFoundError extends PayoutError {
    constructor(identifier: string) {
        super(
            `Payout not found: ${identifier}`,
            'PAYOUT_NOT_FOUND',
            404,
            { identifier }
        );
    }
}

export class WalletSyncRequiredError extends PayoutError {
    constructor(agentId: string, expected: number, actual: number) {
        super(
            `Agent wallet balance mismatch. Expected: ₹${expected.toFixed(2)}, Actual: ₹${actual.toFixed(2)}. Please run wallet sync before processing payout.`,
            'WALLET_SYNC_REQUIRED',
            400,
            { agentId, expected, actual, difference: expected - actual }
        );
    }
}

export class PaymentGatewayError extends PayoutError {
    constructor(message: string, gatewayResponse?: any) {
        super(
            `Payment gateway error: ${message}`,
            'PAYMENT_GATEWAY_ERROR',
            502,
            { gatewayResponse }
        );
    }
}

export class DuplicatePayoutError extends PayoutError {
    constructor(idempotencyKey: string, existingPayoutId: string) {
        super(
            `Duplicate payout detected. A payout with the same parameters already exists.`,
            'DUPLICATE_PAYOUT',
            409,
            { idempotencyKey, existingPayoutId }
        );
    }
}
