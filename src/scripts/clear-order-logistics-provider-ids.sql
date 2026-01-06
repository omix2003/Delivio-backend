-- Temporarily clear logisticsProviderId to allow schema push
UPDATE "Order" SET "logisticsProviderId" = NULL WHERE "logisticsProviderId" IS NOT NULL;




















