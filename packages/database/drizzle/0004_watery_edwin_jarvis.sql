ALTER TABLE "risk_settings" ADD COLUMN "stop_risk_amount" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "risk_settings" ADD COLUMN "stop_risk_currency" varchar(12);