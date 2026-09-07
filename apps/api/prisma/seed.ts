/**
 * Loads the synthetic seed dataset into Postgres.
 *
 *   DATABASE_URL=postgresql://... pnpm --filter @ewaste/api db:seed
 *
 * Idempotent: re-running replaces the seeded rows rather than duplicating
 * them. It refuses to touch a database that already holds non-synthetic
 * recyclers, so it cannot silently overwrite real field data.
 */
import { PrismaClient } from '@prisma/client';
import { generateDataset } from '@ewaste/datasets';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const realRecyclers = await prisma.recycler.count({
    where: { NOT: { authorizationNumber: { startsWith: 'SYN/' } } },
  });
  if (realRecyclers > 0) {
    throw new Error(
      `Refusing to seed: this database holds ${realRecyclers} non-synthetic recycler(s). ` +
        'Seeding is for development databases only.',
    );
  }

  console.log('Generating dataset...');
  const dataset = generateDataset();

  console.log('Clearing previously seeded rows...');
  // Order matters: children before parents.
  await prisma.changeFeed.deleteMany({});
  await prisma.syncChange.deleteMany({});
  await prisma.handover.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.materialItem.deleteMany({});
  await prisma.lot.deleteMany({});
  await prisma.trainingSample.deleteMany({});
  await prisma.pricePoint.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.collector.deleteMany({});
  await prisma.recycler.deleteMany({});

  console.log(`Inserting ${dataset.recyclers.length} recyclers...`);
  await prisma.recycler.createMany({
    data: dataset.recyclers.map((r) => ({
      recyclerId: r.recyclerId,
      name: r.name,
      facilityType: r.facilityType,
      locality: r.place.locality,
      district: r.place.district,
      state: r.place.state,
      lat: r.place.point?.lat ?? null,
      lon: r.place.point?.lon ?? null,
      materialsAccepted: r.materialsAccepted,
      authorizationNumber: r.authorizationNumber,
      authorizationIssuer: r.authorizationIssuer,
      authorizationValidTill: new Date(r.authorizationValidTill),
      authorizationStatus: r.authorizationStatus,
      contactPhone: r.contactPhone,
      contactPersonName: r.contactPersonName ?? null,
      offeredRatesInr: r.offeredRatesInr,
      pickupAvailable: r.pickupAvailable,
      pickupMinWeightKg: r.pickupMinWeightKg ?? null,
      serviceAreaRadiusKm: r.serviceAreaRadiusKm,
      paymentModes: r.paymentModes,
      rating: r.rating ?? null,
      ratingCount: r.ratingCount,
    })),
  });

  console.log(`Inserting ${dataset.collectors.length} collectors...`);
  await prisma.collector.createMany({
    data: dataset.collectors.map((c) => ({
      collectorId: c.collectorId,
      phoneHash: c.phoneHash,
      preferredLanguage: c.preferredLanguage,
      operatingDistrict: c.operatingDistrict,
      operatingState: c.operatingState,
      createdAt: new Date(c.createdAt),
      lifetimeEarningsInr: c.lifetimeEarningsInr,
      pendingDuesInr: c.pendingDuesInr,
      completedTransactions: c.completedTransactions,
    })),
  });

  console.log(`Inserting ${dataset.prices.length} price points...`);
  await insertInChunks(dataset.prices, 2000, (chunk) =>
    prisma.pricePoint.createMany({
      data: chunk.map((p) => ({
        priceId: p.priceId,
        categoryId: p.categoryId,
        subCategoryId: p.subCategoryId,
        district: p.district,
        state: p.state,
        observedAt: new Date(p.observedAt),
        buyingPriceInr: p.buyingPriceInr,
        quotedPriceInr: p.quotedPriceInr ?? null,
        unit: p.unit,
        currency: p.currency,
        marketLowInr: p.marketLowInr,
        marketHighInr: p.marketHighInr,
        recyclerId: p.recyclerId ?? null,
        source: p.source,
        confidence: p.confidence,
      })),
    }),
  );

  console.log(`Inserting ${dataset.lots.length} lots and ${dataset.materials.length} material items...`);
  await insertInChunks(dataset.lots, 500, (chunk) =>
    prisma.lot.createMany({
      data: chunk.map((l) => ({
        lotId: l.lotId,
        collectorId: l.collectorId,
        status: l.status,
        totalWeightKg: l.totalWeightKg,
        estimatedValueInr: l.estimatedValueInr,
        locality: l.collectionPlace.locality,
        district: l.collectionPlace.district,
        state: l.collectionPlace.state,
        lat: l.collectionPlace.point?.lat ?? null,
        lon: l.collectionPlace.point?.lon ?? null,
        collectedAt: new Date(l.collectedAt),
        createdAt: new Date(l.createdAt),
        recyclerId: l.recyclerId ?? null,
        quotedPriceInr: l.quotedPriceInr ?? null,
        notes: l.notes ?? null,
      })),
    }),
  );

  await insertInChunks(dataset.materials, 1000, (chunk) =>
    prisma.materialItem.createMany({
      data: chunk.map((m) => ({
        materialId: m.materialId,
        lotId: m.lotId,
        categoryId: m.categoryId,
        subCategoryId: m.subCategoryId,
        description: m.description,
        imageRefs: m.imageRefs,
        approxWeightKg: m.approxWeightKg,
        unit: m.unit,
        quantity: m.quantity,
        condition: m.condition,
        sourceType: m.sourceType,
        estimatedValueInr: m.estimatedValueInr,
        classificationSource: m.classificationSource,
        modelConfidence: m.modelConfidence ?? null,
        createdAt: new Date(m.createdAt),
      })),
    }),
  );

  console.log(`Inserting ${dataset.transactions.length} transactions...`);
  await insertInChunks(dataset.transactions, 1000, (chunk) =>
    prisma.transaction.createMany({
      data: chunk.map((t) => ({
        transactionId: t.transactionId,
        lotId: t.lotId,
        collectorId: t.collectorId,
        recyclerId: t.recyclerId,
        categorySummary: t.categorySummary,
        totalWeightKg: t.totalWeightKg,
        estimatedValueInr: t.estimatedValueInr,
        quotedPriceInr: t.quotedPriceInr,
        finalPriceInr: t.finalPriceInr,
        collectionDistrict: t.collectionPlace.district,
        handoverDistrict: t.handoverPlace.district,
        handoverAt: new Date(t.handoverAt),
        paymentStatus: t.paymentStatus,
        paymentMode: t.paymentMode,
        paidAt: t.paidAt ? new Date(t.paidAt) : null,
        status: t.status,
        anomalyFlags: t.anomalyFlags,
        createdAt: new Date(t.createdAt),
      })),
    }),
  );

  console.log(`Inserting ${dataset.handovers.length} handover records...`);
  await insertInChunks(dataset.handovers, 1000, (chunk) =>
    prisma.handover.createMany({
      data: chunk.map((h) => ({
        handoverRef: h.handoverRef,
        lotId: h.lotId,
        collectorId: h.collectorId,
        recyclerId: h.recyclerId,
        transactionId: h.transactionId ?? null,
        verificationCode: h.verificationCode,
        digest: h.digest,
        photoRefs: h.photoRefs,
        photoHashes: h.photoHashes,
        declaredWeightKg: h.declaredWeightKg,
        weighedWeightKg: h.weighedWeightKg,
        lat: h.handoverPoint.lat,
        lon: h.handoverPoint.lon,
        locality: h.handoverPlace.locality,
        district: h.handoverPlace.district,
        state: h.handoverPlace.state,
        createdAt: new Date(h.createdAt),
        confirmedAt: h.confirmedAt ? new Date(h.confirmedAt) : null,
        confirmedBy: h.confirmedBy ?? null,
        confirmationStatus: h.confirmationStatus,
        rejectionReason: h.rejectionReason ?? null,
        downstreamStatus: h.downstreamStatus ?? null,
      })),
    }),
  );

  console.log(`Inserting ${dataset.trainingSamples.length} training samples...`);
  await insertInChunks(dataset.trainingSamples, 1000, (chunk) =>
    prisma.trainingSample.createMany({
      data: chunk.map((s) => ({
        sampleId: s.sampleId,
        imageRef: s.imageRef,
        imageHash: s.imageHash,
        labelCategoryId: s.labelCategoryId,
        labelSubCategoryId: s.labelSubCategoryId,
        labelSource: s.labelSource,
        weightKg: s.weightKg,
        district: s.district,
        observedPriceInr: s.observedPriceInr,
        finalPriceInr: s.finalPriceInr ?? null,
        capturedAt: new Date(s.capturedAt),
        split: s.split,
        synthetic: s.synthetic,
      })),
    }),
  );

  console.log('\nSeed complete. Every inserted record is synthetic.');
}

async function insertInChunks<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
