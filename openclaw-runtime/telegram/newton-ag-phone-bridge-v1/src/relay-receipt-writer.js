const githubClient = require('./github-api-client');

/**
 * Writes a receipt for a processed command directly to the remote ledger repository.
 */
async function writeRemoteReceipt(commandId, receiptData) {
    if (!commandId || !receiptData) {
        throw new Error('Command ID and receipt data are required.');
    }
    
    const filePath = `CommandLedger/receipts/${commandId}_receipt.json`;
    const content = JSON.stringify(receiptData, null, 2);
    
    return await githubClient.putFileContent(
        filePath,
        content,
        `Write receipt for command ${commandId}`
    );
}

module.exports = {
    writeRemoteReceipt
};
