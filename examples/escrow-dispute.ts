import { StellarCrossBorderSDK, Keypair } from '@stellar-cross-border/sdk';
import { 
  PaymentRequest, 
  PaymentOptions, 
  ComplianceRequest 
} from '@stellar-cross-border/sdk';

/**
 * Escrow Dispute Resolution Example
 * Demonstrates the complete dispute resolution workflow
 */
async function escrowDisputeResolution() {
  console.log('⚖️  Starting Escrow Dispute Resolution Example...\n');

  // Initialize SDK for testnet
  const config = StellarCrossBorderSDK.createTestnetConfig();
  const contracts = {
    escrow: 'ESCROW_CONTRACT_ADDRESS_HERE',
    rateOracle: 'RATE_ORACLE_CONTRACT_ADDRESS_HERE', 
    compliance: 'COMPLIANCE_CONTRACT_ADDRESS_HERE',
  };

  const sdk = new StellarCrossBorderSDK(config, contracts);

  // Generate participants
  const sellerKeypair = Keypair.random();
  const buyerKeypair = Keypair.random();
  const adminKeypair = Keypair.random(); // Dispute resolution admin

  console.log('👥 Generated Participants:');
  console.log(`Seller: ${sellerKeypair.publicKey()}`);
  console.log(`Buyer: ${buyerKeypair.publicKey()}`);
  console.log(`Admin: ${adminKeypair.publicKey()}\n`);

  try {
    // Fund accounts on testnet
    console.log('💰 Funding testnet accounts...');
    await sdk.clientInstance.fundTestnetAccount(sellerKeypair.publicKey());
    await sdk.clientInstance.fundTestnetAccount(buyerKeypair.publicKey());
    await sdk.clientInstance.fundTestnetAccount(adminKeypair.publicKey());
    console.log('✅ Accounts funded successfully\n');

    // Step 1: Create initial payment
    console.log('🛒 Creating initial payment for digital goods...');
    const paymentRequest: PaymentRequest = {
      from: buyerKeypair.publicKey(),
      to: sellerKeypair.publicKey(),
      amount: '500', // $500 USD
      token: 'USDC',
      release_time: Math.floor(Date.now() / 1000) + (72 * 60 * 60), // 72 hours
      metadata: {
        product_type: new TextEncoder().encode('digital_software'),
        product_id: new TextEncoder().encode('SW-2024-001'),
        license_key: new TextEncoder().encode('TEMP-LICENSE-123'),
        delivery_method: new TextEncoder().encode('digital_download'),
        warranty_period: new TextEncoder().encode('30_days'),
      },
    };

    const paymentOptions: PaymentOptions = {
      feeBump: true,
      memo: 'Digital-Software-Purchase',
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

    console.log('✅ Payment created successfully');
    console.log(`Escrow ID: ${paymentResult.escrowId}\n`);

    // Step 2: Simulate the transaction and issue
    console.log('📦 Simulating transaction...');
    console.log('✅ Buyer sends payment to escrow');
    console.log('✅ Seller notified of payment');
    
    // Simulate delivery issue
    console.log('❌ Issue: Software license key invalid');
    console.log('❌ Issue: Download link not working');
    console.log('❌ Buyer unable to access purchased software\n');

    // Step 3: Buyer attempts resolution with seller
    console.log('🤝 Attempting direct resolution...');
    console.log('📧 Buyer contacts seller support');
    console.log('⏳ Waiting for seller response (24 hours)');
    console.log('❌ Seller unresponsive or unable to resolve issue\n');

    // Step 4: Buyer opens dispute
    console.log('⚖️  Buyer opening formal dispute...');
    const disputeReason = 'INVALID_PRODUCT';
    const disputeEvidence = new TextEncoder().encode(JSON.stringify({
      issue_type: 'invalid_license_key',
      purchase_date: new Date().toISOString(),
      error_messages: [
        'License key not recognized',
        'Download link returns 404 error',
        'Customer support unresponsive'
      ],
      screenshots: ['screenshot1.png', 'screenshot2.png'],
      email_correspondence: ['email1.txt', 'email2.txt'],
    }));

    const disputeResult = await sdk.paymentsInstance.disputeEscrow(
      paymentResult.escrowId,
      buyerKeypair.publicKey(),
      disputeReason,
      disputeEvidence,
      buyerKeypair,
      { feeBump: true }
    );

    if (!disputeResult.success) {
      console.log(`❌ Dispute creation failed: ${disputeResult.error}`);
      return;
    }

    console.log('✅ Dispute created successfully');
    console.log(`Dispute ID: ${disputeResult.disputeId}`);
    console.log(`Dispute Transaction: ${disputeResult.hash}\n`);

    // Step 5: Check escrow status after dispute
    console.log('📊 Checking escrow status after dispute...');
    const disputedStatus = await sdk.paymentsInstance.getPaymentStatus(paymentResult.escrowId);
    console.log(`Status: ${disputedStatus.status}`);
    console.log(`Disputed: ${disputedStatus.status === 'Disputed'}\n`);

    // Step 6: Admin review process
    console.log('🔍 Admin review process initiated...');
    console.log('📋 Collecting evidence from both parties');
    
    // Simulate evidence collection
    const buyerEvidence = {
      original_dispute: disputeEvidence,
      additional_proof: new TextEncoder().encode(JSON.stringify({
        video_evidence: 'screen_recording.mp4',
        system_logs: 'error_logs.txt',
        timestamp: new Date().toISOString(),
      })),
    };

    const sellerEvidence = new TextEncoder().encode(JSON.stringify({
      license_verification: 'license_is_valid.txt',
      server_logs: 'download_access_logs.txt',
      customer_communication: 'support_chat.txt',
    }));

    console.log('✅ Evidence collected from buyer');
    console.log('✅ Evidence collected from seller');
    console.log('⚖️  Admin reviewing case...\n');

    // Step 7: Admin decision
    console.log('⚖️  Admin making decision...');
    
    // Simulate admin review (in real implementation, this would involve actual admin interface)
    setTimeout(() => {
      console.log('📝 Admin review findings:');
      console.log('  • License key provided by seller is indeed invalid');
      console.log('  • Download link is non-functional');
      console.log('  • Buyer made reasonable attempts to resolve directly');
      console.log('  • Seller failed to provide working product');
      console.log('  • Decision: Refund to buyer\n');
    }, 1000);

    // Step 8: Resolve dispute in favor of buyer
    console.log('⚖️  Resolving dispute in favor of buyer...');
    
    // Use the dispute ID returned from the creation to resolve it
    const resolveResult = await sdk.paymentsInstance.resolveDispute(
      disputeResult.disputeId,
      true, // in_favor_of_challenger (buyer gets refund)
      adminKeypair,
      { feeBump: true }
    );

    if (!resolveResult.success) {
      console.log(`❌ Dispute resolution failed: ${resolveResult.error}`);
      return;
    }

    console.log('✅ Dispute resolved');
    console.log(`Decision: Refund to buyer`);
    console.log(`Reason: Seller failed to deliver valid product\n`);

    // Step 9: Process refund
    console.log('💰 Processing refund to buyer...');
    const refundResult = await sdk.paymentsInstance.refundEscrow(
      paymentResult.escrowId,
      buyerKeypair,
      { feeBump: true }
    );

    if (!refundResult.success) {
      console.log(`❌ Refund failed: ${refundResult.error}`);
      return;
    }

    console.log('✅ Refund processed successfully');
    console.log(`Refund Transaction: ${refundResult.hash}\n`);

    // Step 10: Final status check
    console.log('📋 Final escrow status...');
    const finalStatus = await sdk.paymentsInstance.getPaymentStatus(paymentResult.escrowId);
    console.log(`Status: ${finalStatus.status}`);
    console.log(`Amount: ${finalStatus.amount} USDC`);
    console.log(`Refunded to buyer: ✅\n`);

    // Step 11: Generate dispute resolution report
    console.log('📄 Generating Dispute Resolution Report...');
    const disputeReport = {
      case_id: disputeId,
      escrow_id: paymentResult.escrowId,
      payment_amount: '500 USDC',
      parties: {
        buyer: buyerKeypair.publicKey(),
        seller: sellerKeypair.publicKey(),
        admin: adminKeypair.publicKey(),
      },
      timeline: [
        {
          timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          event: 'Payment created',
          actor: 'Buyer',
        },
        {
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          event: 'Dispute opened',
          actor: 'Buyer',
          reason: 'Invalid product',
        },
        {
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          event: 'Admin review started',
          actor: 'Admin',
        },
        {
          timestamp: new Date().toISOString(),
          event: 'Dispute resolved',
          actor: 'Admin',
          decision: 'Refund to buyer',
        },
      ],
      evidence: {
        buyer: ['Invalid license key proof', 'Download error logs', 'Support chat history'],
        seller: ['License verification attempt', 'Server access logs'],
      },
      outcome: {
        decision: 'Refund to buyer',
        reason: 'Seller failed to deliver valid product',
        amount_refunded: '500 USDC',
        refund_transaction: refundResult.hash,
      },
      recommendations: [
        'Seller should improve product delivery process',
        'Implement automated license key verification',
        'Better customer support response time',
        'Consider escrow insurance for high-value transactions',
      ],
    };

    console.log('✅ Dispute Resolution Report Generated:');
    console.log(JSON.stringify(disputeReport, null, 2));

    console.log('\n🎉 Escrow Dispute Resolution Example Completed!');
    console.log('📋 Key Takeaways:');
    console.log('  • Escrow protects both buyers and sellers');
    console.log('  • Dispute process provides fair resolution');
    console.log('  • Evidence collection ensures informed decisions');
    console.log('  • Admin oversight prevents fraud');
    console.log('  • Refunds protect buyers from invalid products');
    console.log(`🔗 View payment on Stellar Explorer: https://stellar.expert/explorer/testnet/tx/${paymentResult.hash}`);

  } catch (error) {
    console.error('❌ Error in dispute resolution flow:', error);
    
    if (error instanceof Error) {
      console.error(`Error details: ${error.message}`);
    }
  }
}

// Error handling wrapper
async function runDisputeExample() {
  try {
    await escrowDisputeResolution();
  } catch (error) {
    console.error('💥 Dispute resolution example failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runDisputeExample();
}

export { escrowDisputeResolution, runDisputeExample };
