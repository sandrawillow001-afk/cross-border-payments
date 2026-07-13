import { StellarCrossBorderSDK, Keypair } from '@stellar-cross-border/sdk';
import { 
  PaymentRequest, 
  PaymentOptions, 
  ExchangeRateRequest, 
  ComplianceRequest 
} from '@stellar-cross-border/sdk';

/**
 * US to Mexico Remittance Flow Example
 * Demonstrates a complete cross-border payment from USD to MXN
 */
async function usdToMxnRemittance() {
  console.log('🚀 Starting USD to MXN Remittance Flow...\n');

  // Initialize SDK for testnet
  const config = StellarCrossBorderSDK.createTestnetConfig();
  const contracts = {
    escrow: 'ESCROW_CONTRACT_ADDRESS_HERE',
    rateOracle: 'RATE_ORACLE_CONTRACT_ADDRESS_HERE', 
    compliance: 'COMPLIANCE_CONTRACT_ADDRESS_HERE',
  };

  const sdk = new StellarCrossBorderSDK(config, contracts);

  // Generate or load user keypairs
  const senderKeypair = Keypair.random();
  const receiverKeypair = Keypair.random();

  console.log('📝 Generated Accounts:');
  console.log(`Sender: ${senderKeypair.publicKey()}`);
  console.log(`Receiver: ${receiverKeypair.publicKey()}\n`);

  try {
    // Fund accounts on testnet
    console.log('💰 Funding testnet accounts...');
    await sdk.clientInstance.fundTestnetAccount(senderKeypair.publicKey());
    await sdk.clientInstance.fundTestnetAccount(receiverKeypair.publicKey());
    console.log('✅ Accounts funded successfully\n');

    // Step 1: Get current exchange rate
    console.log('💱 Getting USD to MXN exchange rate...');
    const rateRequest: ExchangeRateRequest = {
      from_currency: 'USD',
      to_currency: 'MXN',
    };

    const exchangeRate = await sdk.paymentsInstance.getExchangeRate(rateRequest);
    console.log(`Current Rate: 1 USD = ${exchangeRate.rate} MXN`);
    console.log(`Last Updated: ${new Date(exchangeRate.timestamp * 1000).toLocaleString()}\n`);

    // Step 2: Check compliance
    console.log('🔍 Running compliance checks...');
    const complianceRequest: ComplianceRequest = {
      from_user: senderKeypair.publicKey(),
      to_user: receiverKeypair.publicKey(),
      amount: '1000', // $1000 USD
      currency: 'USD',
      jurisdiction_from: 'US',
      jurisdiction_to: 'MX',
    };

    const complianceResult = await sdk.paymentsInstance.checkCompliance(complianceRequest);
    
    if (!complianceResult.approved) {
      console.log(`❌ Compliance check failed: ${complianceResult.reason}`);
      console.log(`Rules triggered: ${complianceResult.rulesTriggered.join(', ')}`);
      return;
    }

    console.log('✅ Compliance check passed');
    console.log(`Rules triggered: ${complianceResult.rulesTriggered.join(', ')}\n`);

    // Step 3: Calculate amount in MXN
    const usdAmount = '1000';
    const mxnAmount = (parseFloat(usdAmount) * parseFloat(exchangeRate.rate)).toFixed(2);
    console.log(`💸 Payment Amount: ${usdAmount} USD = ${mxnAmount} MXN\n`);

    // Step 4: Create escrow payment
    console.log('🔒 Creating time-locked escrow...');
    const paymentRequest: PaymentRequest = {
      from: senderKeypair.publicKey(),
      to: receiverKeypair.publicKey(),
      amount: usdAmount,
      token: 'USDC', // Using USDC token
      release_time: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      metadata: {
        purpose: new TextEncoder().encode('remittance'),
        reference: new TextEncoder().encode('US-MX-2024-001'),
        sender_country: new TextEncoder().encode('US'),
        receiver_country: new TextEncoder().encode('MX'),
      },
    };

    const paymentOptions: PaymentOptions = {
      feeBump: true, // Use fee bump for cross-border reliability
      memo: 'US-MX Remittance',
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

    console.log('✅ Escrow created successfully');
    console.log(`Transaction Hash: ${paymentResult.hash}`);
    console.log(`Escrow ID: ${paymentResult.escrowId}\n`);

    // Step 5: Monitor payment status
    console.log('📊 Monitoring payment status...');
    const checkStatus = async () => {
      const status = await sdk.paymentsInstance.getPaymentStatus(paymentResult.escrowId);
      
      console.log(`Status: ${status.status}`);
      console.log(`Amount: ${status.amount} USD`);
      console.log(`Created: ${new Date(status.created_at * 1000).toLocaleString()}`);
      console.log(`Release Time: ${new Date(status.release_time * 1000).toLocaleString()}`);
      console.log(`Can Release: ${status.can_release}`);
      console.log(`Can Refund: ${status.can_refund}\n`);

      return status;
    };

    let currentStatus = await checkStatus();

    // Wait for release time (in real scenario, this would be event-driven)
    if (currentStatus.status === 'Pending') {
      console.log('⏳ Waiting for release time...');
      
      // Simulate waiting (in production, you'd wait for actual time)
      const releaseIn = currentStatus.release_time - Math.floor(Date.now() / 1000);
      if (releaseIn > 0) {
        console.log(`Release available in ${Math.floor(releaseIn / 60)} minutes`);
        
        // For demo purposes, we'll skip the actual wait
        console.log('⏭️  Skipping wait for demo...\n');
      }
    }

    // Step 6: Release funds to receiver
    console.log('🔓 Releasing funds to receiver...');
    const releaseResult = await sdk.paymentsInstance.releaseEscrow(
      paymentResult.escrowId,
      receiverKeypair,
      { feeBump: true }
    );

    if (!releaseResult.success) {
      console.log(`❌ Release failed: ${releaseResult.error}`);
      return;
    }

    console.log('✅ Funds released successfully');
    console.log(`Transaction Hash: ${releaseResult.hash}\n`);

    // Final status check
    console.log('📋 Final Payment Status:');
    const finalStatus = await checkStatus();

    console.log('🎉 USD to MXN Remittance Flow Completed Successfully!');
    console.log(`💰 Total Amount: ${usdAmount} USD sent, ${mxnAmount} MXN received`);
    console.log(`🔗 View on Stellar Explorer: https://stellar.expert/explorer/testnet/tx/${paymentResult.hash}`);

  } catch (error) {
    console.error('❌ Error in remittance flow:', error);
    
    if (error instanceof Error) {
      console.error(`Error details: ${error.message}`);
    }
  }
}

// Error handling wrapper
async function runUsdToMxnExample() {
  try {
    await usdToMxnRemittance();
  } catch (error) {
    console.error('💥 Example failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runUsdToMxnExample();
}

export { usdToMxnRemittance, runUsdToMxnExample };
