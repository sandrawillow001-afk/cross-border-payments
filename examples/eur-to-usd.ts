import { StellarCrossBorderSDK, Keypair } from '@stellar-cross-border/sdk';
import { 
  PaymentRequest, 
  PaymentOptions, 
  ExchangeRateRequest, 
  ComplianceRequest 
} from '@stellar-cross-border/sdk';

/**
 * Europe to US Business Payment Example
 * Demonstrates a B2B cross-border payment from EUR to USD
 */
async function eurToUsdBusinessPayment() {
  console.log('🏢 Starting EUR to USD Business Payment Flow...\n');

  // Initialize SDK for testnet
  const config = StellarCrossBorderSDK.createTestnetConfig();
  const contracts = {
    escrow: 'ESCROW_CONTRACT_ADDRESS_HERE',
    rateOracle: 'RATE_ORACLE_CONTRACT_ADDRESS_HERE', 
    compliance: 'COMPLIANCE_CONTRACT_ADDRESS_HERE',
  };

  const sdk = new StellarCrossBorderSDK(config, contracts);

  // Generate or load business accounts
  const businessKeypair = Keypair.random();
  const vendorKeypair = Keypair.random();

  console.log('🏢 Generated Business Accounts:');
  console.log(`Business (EU): ${businessKeypair.publicKey()}`);
  console.log(`Vendor (US): ${vendorKeypair.publicKey()}\n`);

  try {
    // Fund accounts on testnet
    console.log('💰 Funding testnet accounts...');
    await sdk.clientInstance.fundTestnetAccount(businessKeypair.publicKey());
    await sdk.clientInstance.fundTestnetAccount(vendorKeypair.publicKey());
    console.log('✅ Accounts funded successfully\n');

    // Step 1: Get current exchange rate
    console.log('💱 Getting EUR to USD exchange rate...');
    const rateRequest: ExchangeRateRequest = {
      from_currency: 'EUR',
      to_currency: 'USD',
    };

    const exchangeRate = await sdk.paymentsInstance.getExchangeRate(rateRequest);
    console.log(`Current Rate: 1 EUR = ${exchangeRate.rate} USD`);
    console.log(`Sources: ${exchangeRate.aggregated.sources_count} active sources`);
    console.log(`Confidence: ${exchangeRate.aggregated.deviation_threshold}% deviation threshold\n`);

    // Step 2: Register users for compliance (business accounts need higher compliance)
    console.log('📋 Registering business accounts for compliance...');
    
    // In a real implementation, you would register users with the compliance contract
    // For this example, we'll assume they're already registered with appropriate KYC levels
    console.log('✅ Business accounts registered with Enhanced KYC\n');

    // Step 3: Check compliance for business payment
    console.log('🔍 Running compliance checks for business payment...');
    const complianceRequest: ComplianceRequest = {
      from_user: businessKeypair.publicKey(),
      to_user: vendorKeypair.publicKey(),
      amount: '50000', // €50,000 EUR - large business payment
      currency: 'EUR',
      jurisdiction_from: 'DE', // Germany
      jurisdiction_to: 'US',
    };

    const complianceResult = await sdk.paymentsInstance.checkCompliance(complianceRequest);
    
    if (!complianceResult.approved) {
      console.log(`❌ Compliance check failed: ${complianceResult.reason}`);
      console.log(`Rules triggered: ${complianceResult.rulesTriggered.join(', ')}`);
      
      // For large payments, additional manual review might be needed
      if (complianceResult.reason.includes('HIGH_AMOUNT_THRESHOLD')) {
        console.log('📞 Large payment detected - manual review required');
        console.log('🔄 Initiating enhanced due diligence process...');
        
        // In a real scenario, this would trigger manual review workflow
        // For demo, we'll proceed assuming approval after review
        console.log('✅ Manual review completed - payment approved\n');
      } else {
        return;
      }
    } else {
      console.log('✅ Compliance check passed');
      console.log(`Rules triggered: ${complianceResult.rulesTriggered.join(', ')}\n`);
    }

    // Step 4: Calculate amount in USD
    const eurAmount = '50000';
    const usdAmount = (parseFloat(eurAmount) * parseFloat(exchangeRate.rate)).toFixed(2);
    console.log(`💸 Payment Amount: ${eurAmount} EUR = ${usdAmount} USD\n`);

    // Step 5: Create escrow payment with business metadata
    console.log('🔒 Creating business escrow payment...');
    const paymentRequest: PaymentRequest = {
      from: businessKeypair.publicKey(),
      to: vendorKeypair.publicKey(),
      amount: eurAmount,
      token: 'EURC', // Using EURC token
      release_time: Math.floor(Date.now() / 1000) + (48 * 60 * 60), // 48 hours for business
      metadata: {
        payment_type: new TextEncoder().encode('business_payment'),
        invoice_number: new TextEncoder().encode('INV-2024-001234'),
        contract_reference: new TextEncoder().encode('B2C-2024-5678'),
        sender_business_id: new TextEncoder().encode('EU-BIZ-001'),
        receiver_business_id: new TextEncoder().encode('US-BIZ-002'),
        payment_purpose: new TextEncoder().encode('software_licenses'),
        vat_number: new TextEncoder().encode('DE123456789'),
      },
    };

    const paymentOptions: PaymentOptions = {
      feeBump: true, // Always use fee bump for business payments
      memo: 'B2B-EUR-USD-Software-Licenses',
      submit: true,
    };

    const paymentResult = await sdk.paymentsInstance.createPayment(
      paymentRequest,
      paymentOptions
    );

    if (!paymentResult.success) {
      console.log(`❌ Payment creation failed: ${paymentResult.error}`);
      return;
    }

    console.log('✅ Business escrow created successfully');
    console.log(`Transaction Hash: ${paymentResult.hash}`);
    console.log(`Escrow ID: ${paymentResult.escrowId}\n`);

    // Step 6: Monitor payment status
    console.log('📊 Monitoring business payment status...');
    const checkStatus = async () => {
      const status = await sdk.paymentsInstance.getPaymentStatus(paymentResult.escrowId);
      
      console.log(`Status: ${status.status}`);
      console.log(`Amount: ${status.amount} EUR`);
      console.log(`Created: ${new Date(status.created_at * 1000).toLocaleString()}`);
      console.log(`Release Time: ${new Date(status.release_time * 1000).toLocaleString()}`);
      console.log(`Can Release: ${status.can_release}`);
      console.log(`Can Refund: ${status.can_refund}\n`);

      return status;
    };

    let currentStatus = await checkStatus();

    // Step 7: Business verification and approval workflow
    console.log('🔍 Business verification workflow...');
    console.log('✅ Invoice verified');
    console.log('✅ Contract terms confirmed');
    console.log('✅ Delivery receipt received\n');

    // Wait for release time (in real scenario, this might be after goods/services delivery)
    if (currentStatus.status === 'Pending') {
      console.log('⏳ Waiting for payment release conditions...');
      console.log('📦 Awaiting delivery confirmation...\n');
      
      // Simulate business workflow
      setTimeout(async () => {
        console.log('✅ Delivery confirmed - payment can be released\n');
      }, 2000);
    }

    // Step 8: Release funds to vendor
    console.log('🔓 Releasing funds to vendor...');
    const releaseResult = await sdk.paymentsInstance.releaseEscrow(
      paymentResult.escrowId,
      vendorKeypair,
      { feeBump: true }
    );

    if (!releaseResult.success) {
      console.log(`❌ Release failed: ${releaseResult.error}`);
      return;
    }

    console.log('✅ Business payment released successfully');
    console.log(`Transaction Hash: ${releaseResult.hash}\n`);

    // Final status check
    console.log('📋 Final Business Payment Status:');
    const finalStatus = await checkStatus();

    console.log('🎉 EUR to USD Business Payment Completed Successfully!');
    console.log(`💰 Total Amount: ${eurAmount} EUR sent, ${usdAmount} USD received`);
    console.log(`📋 Invoice: INV-2024-001234`);
    console.log(`📄 Contract: B2C-2024-5678`);
    console.log(`🔗 View on Stellar Explorer: https://stellar.expert/explorer/testnet/tx/${paymentResult.hash}`);

    // Step 9: Generate payment confirmation
    console.log('\n📄 Generating Payment Confirmation...');
    const confirmation = {
      payment_id: paymentResult.escrowId,
      transaction_hash: paymentResult.hash,
      amount_eur: eurAmount,
      amount_usd: usdAmount,
      exchange_rate: exchangeRate.rate,
      sender: businessKeypair.publicKey(),
      receiver: vendorKeypair.publicKey(),
      timestamp: new Date().toISOString(),
      status: 'Completed',
      purpose: 'Software Licenses',
      invoice_number: 'INV-2024-001234',
    };

    console.log('✅ Payment Confirmation Generated:');
    console.log(JSON.stringify(confirmation, null, 2));

  } catch (error) {
    console.error('❌ Error in business payment flow:', error);
    
    if (error instanceof Error) {
      console.error(`Error details: ${error.message}`);
    }
  }
}

// Error handling wrapper
async function runEurToUsdExample() {
  try {
    await eurToUsdBusinessPayment();
  } catch (error) {
    console.error('💥 Business payment example failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runEurToUsdExample();
}

export { eurToUsdBusinessPayment, runEurToUsdExample };
