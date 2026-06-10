import { ensureAnchorRiverLoan } from './repository';

async function main() {
  const id = await ensureAnchorRiverLoan();
  console.log(`Anchor River loan ready with id=${id}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
