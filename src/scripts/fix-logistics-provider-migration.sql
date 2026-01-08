-- Step 1: Drop the existing foreign key constraint on Order.logisticsProviderId (if it exists)
-- This allows us to change the reference from Partner to LogisticsProvider
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'Order_logisticsProviderId_fkey'
    ) THEN
        ALTER TABLE "Order" DROP CONSTRAINT "Order_logisticsProviderId_fkey";
        RAISE NOTICE 'Dropped existing foreign key constraint';
    ELSE
        RAISE NOTICE 'Foreign key constraint does not exist';
    END IF;
END $$;

-- Step 2: Now you can run: npx prisma db push
-- Step 3: After schema is applied, run the migration script to populate LogisticsProvider table






















