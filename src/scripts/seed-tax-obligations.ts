import { addTaxObligation, listTaxObligations } from '../db/compliance-repository';

async function main() {
  const existing = await listTaxObligations();
  if (existing.length > 0) {
    console.log(`Skipping seed: ${existing.length} tax obligation(s) already exist.`);
    return;
  }

  const obligations = [
    {
      parcelGroup: 'Parcel A (buyer-owned, buyer pays)',
      parcelPin: '16902303',
      parcelUrl:
        'https://kpb.publicaccessnow.com/PropertyTax/TaxSearch/Account.aspx?p=16902303&a=53501',
      amountCents: 43084,
      dueDateISO: '2026-09-15',
      delinquencyDateISO: '2026-11-16',
      createdBy: 'system',
    },
    {
      parcelGroup: 'Parcel B (buyer-owned, buyer pays)',
      parcelPin: '16902302',
      parcelUrl:
        'https://kpb.publicaccessnow.com/PropertyTax/TaxSearch/Account.aspx?p=16902302&a=53500',
      amountCents: 101624,
      dueDateISO: '2026-09-15',
      delinquencyDateISO: '2026-11-16',
      createdBy: 'system',
    },
    {
      parcelGroup: 'Parcel C - Option Property (seller-owned, buyer pays per contract §27a)',
      parcelPin: '16902102',
      parcelUrl:
        'https://kpb.publicaccessnow.com/PropertyTax/TaxSearch/Account.aspx?p=16902102&a=53485',
      amountCents: 83656,
      dueDateISO: '2026-09-15',
      delinquencyDateISO: '2026-11-16',
      createdBy: 'system',
    },
  ];

  for (const ob of obligations) {
    const row = await addTaxObligation(ob);
    console.log(`Inserted: id=${row.id} group="${row.parcelGroup}"`);
  }

  console.log('Seed complete.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
