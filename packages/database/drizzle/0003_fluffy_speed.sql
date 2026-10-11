CREATE TABLE "account_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar(160) NOT NULL,
	"currency" varchar(12) NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"balance" numeric(20, 8) NOT NULL,
	"equity" numeric(20, 8) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_observations_bucket" ON "account_observations" USING btree ("account_id","currency","bucket");