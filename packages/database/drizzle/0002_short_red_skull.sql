ALTER TABLE "risk_settings" ADD COLUMN "key" varchar(40) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_key_unique" UNIQUE("key");