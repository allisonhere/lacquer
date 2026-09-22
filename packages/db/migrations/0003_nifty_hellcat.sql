CREATE TABLE "appointment_contacts" (
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"customer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_contacts_appointment_id_tenant_id_pk" PRIMARY KEY("appointment_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_public_access" (
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"price_mode" "price_display_mode" NOT NULL,
	"duration_mode" "duration_display_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_public_access_appointment_id_tenant_id_pk" PRIMARY KEY("appointment_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "public_booking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_contacts" ADD CONSTRAINT "appointment_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_contacts" ADD CONSTRAINT "appointment_contacts_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_public_access" ADD CONSTRAINT "appointment_public_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_public_access" ADD CONSTRAINT "appointment_public_access_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_public_token_unique" ON "appointment_public_access" USING btree ("token_hash");