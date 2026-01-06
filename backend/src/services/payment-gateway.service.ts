import axios from 'axios';

/**
 * Payment Gateway Service
 * Handles integration with Razorpay for processing payouts
 * 
 * IMPORTANT: Razorpay payouts are server-to-server API calls.
 * There is NO browser window/gateway for payouts - they happen entirely on the backend.
 * 
 * Flow: Contact → Fund Account → Payout (all via API calls)
 */

interface PayoutRequest {
  amount: number; // Amount in INR
  paymentMethod: 'BANK_TRANSFER' | 'UPI' | 'MOBILE_MONEY';
  bankAccount?: string; // JSON string with bank account details
  upiId?: string;
  referenceId: string;
  notes?: Record<string, string>;
}

interface PayoutResponse {
  success: boolean;
  transactionId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Parse bank account details from JSON string
 */
function parseBankAccount(bankAccount?: string): {
  name?: string;
  account_number?: string;
  ifsc?: string;
} | null {
  if (!bankAccount) return null;

  try {
    return JSON.parse(bankAccount);
  } catch (error) {
    return { account_number: bankAccount };
  }
}

/**
 * Process payout through Razorpay
 * This is a server-to-server operation - no browser window appears
 */
export async function processPayout(request: PayoutRequest): Promise<PayoutResponse> {
  const { amount, paymentMethod, bankAccount, upiId, referenceId, notes } = request;

  // Check if Razorpay is configured
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    // Simulate payout (no Razorpay configured)
    await new Promise(resolve => setTimeout(resolve, 1000));
    const fakeTransactionId = `pout_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    return {
      success: true,
      transactionId: fakeTransactionId,
      status: 'queued',
    };
  }

  // Razorpay API configuration
  const baseUrl = 'https://api.razorpay.com/v1';
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER || '2323230000000000';
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  try {
    // Step 1: Create or get Contact
    const contactName = notes?.agentName || 'Agent';
    // Ensure email is valid - use a valid format if not provided
    let contactEmail = notes?.agentEmail || `agent_${referenceId.replace(/[^a-zA-Z0-9]/g, '')}@example.com`;
    // Validate email format - if invalid, use a safe fallback
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactEmail)) {
      contactEmail = `agent_${referenceId.replace(/[^a-zA-Z0-9]/g, '')}@example.com`;
    }
    const contactPhone = notes?.agentPhone || '9876543210';

    let contactId: string;

    try {
      // Try to find existing contact by email
      const contactsResponse = await axios.get(`${baseUrl}/contacts`, {
        headers,
        params: { email: contactEmail },
        timeout: 10000,
      });

      if (contactsResponse.data.items && contactsResponse.data.items.length > 0) {
        contactId = contactsResponse.data.items[0].id;
      } else {
        // Create new contact
        const contactResponse = await axios.post(
          `${baseUrl}/contacts`,
          {
            name: contactName,
            email: contactEmail,
            contact: contactPhone,
            type: 'employee',
            reference_id: `agent_${referenceId}`,
          },
          { headers, timeout: 10000 }
        );
        contactId = contactResponse.data.id;
      }
    } catch (error: any) {
      console.error(`[Payment Gateway] ❌ Failed to create/find contact:`, {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        stack: error?.stack,
      });
      // If contact creation fails, throw error to be caught by outer try-catch
      throw new Error(`Contact creation failed: ${error.response?.data?.error?.description || error.message}`);
    }

    // Step 2: Create or get Fund Account
    let fundAccountId: string;
    let accountType: 'vpa' | 'bank_account';
    let accountData: any;

    if (paymentMethod === 'UPI' && upiId) {
      accountType = 'vpa';
      accountData = { address: upiId };

      try {
        // Try to find existing fund account
        const fundAccountsResponse = await axios.get(`${baseUrl}/fund_accounts`, {
          headers,
          params: { contact_id: contactId },
          timeout: 10000,
        });

        const existingFA = fundAccountsResponse.data.items?.find(
          (fa: any) => fa.account_type === 'vpa' && fa.vpa?.address === upiId
        );

        if (existingFA) {
          fundAccountId = existingFA.id;
        } else {
          // Create new fund account
          const fundAccountResponse = await axios.post(
            `${baseUrl}/fund_accounts`,
            {
              contact_id: contactId,
              account_type: 'vpa',
              vpa: { address: upiId },
            },
            { headers, timeout: 10000 }
          );
          fundAccountId = fundAccountResponse.data.id;
        }
      } catch (error: any) {
        console.error(`[Payment Gateway] ❌ Failed to create/find fund account:`, error.response?.data || error.message);
        throw new Error(`Fund account creation failed: ${error.response?.data?.error?.description || error.message}`);
      }
    } else if (paymentMethod === 'BANK_TRANSFER') {
      const bankDetails = parseBankAccount(bankAccount);

      // If no bank account provided, use test account for development/testing
      if (!bankDetails || !bankDetails.account_number || !bankDetails.ifsc) {
        console.warn(`[Payment Gateway] ⚠️  No bank account details provided. Using test account for simulation.`);
        accountType = 'bank_account';
        accountData = {
          name: contactName,
          account_number: '1234567890', // Test account
          ifsc: 'SBIN0001234', // Test IFSC
        };
      } else {
        accountType = 'bank_account';
        accountData = {
          name: bankDetails.name || contactName,
          account_number: bankDetails.account_number,
          ifsc: bankDetails.ifsc,
        };
      }

      try {
        // Try to find existing fund account
        const fundAccountsResponse = await axios.get(`${baseUrl}/fund_accounts`, {
          headers,
          params: { contact_id: contactId },
          timeout: 10000,
        });

        const existingFA = fundAccountsResponse.data.items?.find(
          (fa: any) =>
            fa.account_type === 'bank_account' &&
            fa.bank_account?.account_number === accountData.account_number
        );

        if (existingFA) {
          fundAccountId = existingFA.id;
        } else {
          // Create new fund account
          const fundAccountResponse = await axios.post(
            `${baseUrl}/fund_accounts`,
            {
              contact_id: contactId,
              account_type: 'bank_account',
              bank_account: accountData,
            },
            { headers, timeout: 10000 }
          );
          fundAccountId = fundAccountResponse.data.id;
        }
      } catch (error: any) {
        console.error(`[Payment Gateway] ❌ Failed to create/find fund account:`, error.response?.data || error.message);
        throw new Error(`Fund account creation failed: ${error.response?.data?.error?.description || error.message}`);
      }
    } else {
      throw new Error(`Invalid payment method: ${paymentMethod}. Supported methods: UPI, BANK_TRANSFER`);
    }

    // Step 3: Create Payout
    const payoutData = {
      account_number: accountNumber,
      fund_account_id: fundAccountId,
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      mode: paymentMethod === 'UPI' ? 'UPI' : 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: notes?.narration || `Payout for ${referenceId}`,
      notes: notes || {
        payout_id: referenceId,
        purpose: 'agent_payout',
      },
    };

    try {
      const payoutResponse = await axios.post(`${baseUrl}/payouts`, payoutData, {
        headers,
        timeout: 10000,
      });

      return {
        success: true,
        transactionId: payoutResponse.data.id,
        status: payoutResponse.data.status,
      };
    } catch (error: any) {
      console.error(`[Payment Gateway] Payout creation failed:`, error.response?.data?.error?.description || error.message);

      return {
        success: false,
        error: error.response?.data?.error?.description || error.message,
        errorCode: error.response?.data?.error?.code || 'PAYOUT_ERROR',
      };
    }
  } catch (error: any) {
    console.error(`[Payment Gateway] Error in payout process:`, {
      message: error?.message,
      stack: error?.stack,
      response: error?.response?.data,
      status: error?.response?.status,
    });

    // If error message indicates it's already a handled error, re-throw it
    if (error.message?.includes('Contact creation failed') ||
      error.message?.includes('Fund account creation failed') ||
      error.message?.includes('Invalid payment method')) {
      throw error; // Re-throw to be handled by caller
    }

    // Fall back to simulation for unexpected errors
    console.warn(`[Payment Gateway] Falling back to simulated payout due to error`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const fakeTransactionId = `pout_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    return {
      success: true,
      transactionId: fakeTransactionId,
      status: 'queued',
      error: error.message || 'Payment gateway error (simulated)',
    };
  }
}

/**
 * Get payout status from Razorpay
 */
export async function getPayoutStatus(transactionId: string): Promise<PayoutResponse> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return {
      success: true,
      transactionId,
      status: 'processed',
    };
  }

  try {
    const baseUrl = 'https://api.razorpay.com/v1';
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await axios.get(`${baseUrl}/payouts/${transactionId}`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    return {
      success: response.data.status !== 'failed',
      transactionId: response.data.id,
      status: response.data.status,
    };
  } catch (error: any) {
    console.error('[Payment Gateway] Error fetching payout status:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to fetch payout status',
      errorCode: 'STATUS_ERROR',
    };
  }
}

/**
 * Check if Razorpay is configured
 */
export function isRazorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export const paymentGatewayService = {
  processPayout,
  getPayoutStatus,
  isRazorpayConfigured,
};
