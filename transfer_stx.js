import { generateWallet, generateNewAccount } from '@stacks/wallet-sdk';
import { makeSTXTokenTransfer, broadcastRawTransaction, AnchorMode, TransactionVersion, getAddressFromPrivateKey } from '@stacks/transactions';
import { StacksMainnet } from '@stacks/network';
import dotenv from 'dotenv';
import { setTimeout } from 'timers/promises';

dotenv.config();

// Global nonce cache to track nonces across loops
const nonceCache = new Map();

async function getNonce(address, network) {
    if (nonceCache.has(address)) {
        return nonceCache.get(address);
    }
    const apiUrl = network.coreApiUrl;
    try {
        const nonceRes = await fetch(`${apiUrl}/v2/accounts/${address}?proof=0`);
        const nonceData = await nonceRes.json();
        const nonce = BigInt(nonceData.nonce);
        nonceCache.set(address, nonce);
        return nonce;
    } catch (e) {
        console.error(`Error fetching nonce for ${address}:`, e);
        return 0n; // Fallback, though dangerous if account active
    }
}

async function sendTransaction(senderAccount, recipientAddress, amount, memo, network, delaySec = 5) {
    const senderAddress = getAddressFromPrivateKey(senderAccount.stxPrivateKey, TransactionVersion.Mainnet);
    const nonce = await getNonce(senderAddress, network);

    console.log(`\nSender: ${senderAddress}`);
    console.log(`Recipient: ${recipientAddress}`);
    console.log(`Amount: ${Number(amount) / 1000000} STX`);
    console.log(`Nonce: ${nonce}`);

    const txOptions = {
        recipient: recipientAddress,
        amount: amount,
        senderKey: senderAccount.stxPrivateKey,
        network,
        memo: memo,
        anchorMode: AnchorMode.Any,
        nonce: nonce,
    };

    try {
        const transaction = await makeSTXTokenTransfer(txOptions);
        const serialized = transaction.serialize();
        const broadcastResponse = await broadcastRawTransaction(serialized, `${network.coreApiUrl}/v2/transactions`);

        console.log('Broadcast Response:', broadcastResponse);

        if (broadcastResponse.error) {
            console.error(`Broadcast failed: ${broadcastResponse.error}`);
            // Do not increment nonce on error (unless we want to skip)
            // But usually, we only increment if we think it went through.
            // For now, we increment only on success string or txid
        } else {
            console.log(`TXID: ${broadcastResponse}`);
            // Update nonce in cache
            nonceCache.set(senderAddress, nonce + 1n);
        }
    } catch (error) {
        console.error('Error constructing/broadcasting transaction:', error);
    }

    if (delaySec > 0) {
        console.log(`Waiting ${delaySec} seconds...`);
        await setTimeout(delaySec * 1000);
    }
}

async function main() {
    const mnemonic = process.env.STACKS_MNEMONIC;
    if (!mnemonic) {
        throw new Error('STACKS_MNEMONIC is not defined in .env');
    }

    const network = new StacksMainnet();

    console.log('Initializing wallet...');
    let wallet = await generateWallet({ secretKey: mnemonic, password: '' });

    // Generate accounts up to index 62 (total 63 accounts: 0 to 62)
    console.log('Generating accounts 1-62...');
    while (wallet.accounts.length <= 62) {
        wallet = generateNewAccount(wallet);
    }

    const account0 = wallet.accounts[0];
    const acc0Address = getAddressFromPrivateKey(account0.stxPrivateKey, TransactionVersion.Mainnet);

    // Pre-fetch nonce for Account 0 to ensure readiness
    await getNonce(acc0Address, network);

    // Amounts
    const distributeAmount = 1000n; // 0.001 STX
    const returnAmount = 500n; // 0.0005 STX

    // 1 Cycle
    for (let cycle = 1; cycle <= 1; cycle++) {
        console.log(`\n================================`);
        console.log(`      STARTING CYCLE ${cycle} of 1`);
        console.log(`================================`);

        // Phase 1: Account 0 sends to Accounts 1-62
        console.log(`\n--- Phase 1: Distribution (Acc 0 -> Acc 1..62) ---`);
        for (let i = 1; i <= 62; i++) {
            const recipientAcc = wallet.accounts[i];
            const recipientAddress = getAddressFromPrivateKey(recipientAcc.stxPrivateKey, TransactionVersion.Mainnet);

            await sendTransaction(
                account0,
                recipientAddress,
                distributeAmount,
                `Cycle ${cycle} Distribute`,
                network
            );
        }

        // Phase 2: Accounts 1-62 send back to Account 0
        console.log(`\n--- Phase 2: Collection (Acc 1..62 -> Acc 0) ---`);
        for (let i = 1; i <= 62; i++) {
            const senderAcc = wallet.accounts[i];

            // Acc0 is the recipient
            await sendTransaction(
                senderAcc,
                acc0Address,
                returnAmount,
                `Cycle ${cycle} Return`,
                network
            );
        }
    }

    console.log('\nAll 5 cycles completed.');
}

main().catch(console.error);
