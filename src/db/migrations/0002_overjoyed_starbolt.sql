ALTER TABLE "subplans"
    ALTER COLUMN "price" SET DATA TYPE numeric(10, 2)
    USING "price"::numeric(10, 2);