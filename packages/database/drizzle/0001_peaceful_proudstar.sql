ALTER TABLE "trading_signals" ADD COLUMN "validation_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trading_signals" ADD COLUMN "risk_validation_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trading_signals" ADD COLUMN "broker_request_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trading_signals" ADD COLUMN "broker_confirmation_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trading_signals" ADD COLUMN "broker_latency_ms" integer;