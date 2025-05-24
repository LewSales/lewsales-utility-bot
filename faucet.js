import { PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  transfer
} from '@solana/spl-token';

const TOKEN_MINT = new PublicKey(process.env.WINLEW_MINT);

export async function dripTokens(connection, payerKeypair, recipientPubkey) {
  // 1. Figure out where the payer’s and recipient’s boxes live:
  const fromAta = await getAssociatedTokenAddress(
    TOKEN_MINT,
    payerKeypair.publicKey
  );
  const toAta = await getAssociatedTokenAddress(
    TOKEN_MINT,
    recipientPubkey
  );

  // 2. Move the tokens (will throw an error if the recipient box doesn't exist):
  const signature = await transfer(
    connection,
    payerKeypair,          // who pays the fees and signs
    fromAta,               // your sticker box
    toAta,                 // their sticker box
    payerKeypair.publicKey,
    Number(process.env.DRIP_AMOUNT) * 10 ** 6
  );

  console.log(`Sent ${process.env.DRIP_AMOUNT} $WinLEW →`, toAta.toBase58());
  return signature;
}