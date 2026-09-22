CREATE TYPE "public"."appointment_source" AS ENUM('staff', 'online');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'cancelled');--> statement-breakpoint
CREATE TABLE "appointment_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_service_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor_units" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	CONSTRAINT "appointment_addons_unique" UNIQUE("appointment_service_id","add_on_id"),
	CONSTRAINT "appointment_addons_values" CHECK ("appointment_addons"."price_minor_units" >= 0 AND "appointment_addons"."duration_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "appointment_idempotency" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"appointment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_idempotency_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "appointment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"variant_id" uuid,
	"position" integer NOT NULL,
	"service_name" text NOT NULL,
	"variant_name" text,
	"price_minor_units" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active_minutes" integer NOT NULL,
	"processing_minutes" integer NOT NULL,
	"buffer_before_minutes" integer NOT NULL,
	"buffer_after_minutes" integer NOT NULL,
	CONSTRAINT "appointment_services_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "appointment_services_position_unique" UNIQUE("appointment_id","position"),
	CONSTRAINT "appointment_services_values" CHECK ("appointment_services"."position" >= 0 AND "appointment_services"."price_minor_units" >= 0 AND "appointment_services"."duration_minutes" > 0 AND "appointment_services"."active_minutes" > 0 AND "appointment_services"."processing_minutes" >= 0 AND "appointment_services"."active_minutes" + "appointment_services"."processing_minutes" = "appointment_services"."duration_minutes" AND "appointment_services"."buffer_before_minutes" >= 0 AND "appointment_services"."buffer_after_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "appointment_staff_assignments" (
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	CONSTRAINT "appointment_staff_assignments_appointment_id_staff_id_pk" PRIMARY KEY("appointment_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"previous_starts_at" timestamp with time zone,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"forced_conflict" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_history_action" CHECK ("appointment_status_history"."action" IN ('created', 'rescheduled', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"primary_staff_id" uuid NOT NULL,
	"client_id" uuid,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"source" "appointment_source" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location_timezone" text NOT NULL,
	"total_service_minutes" integer NOT NULL,
	"total_occupancy_minutes" integer NOT NULL,
	"subtotal_minor_units" integer NOT NULL,
	"notes" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "appointments_time_order" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_totals" CHECK ("appointments"."total_service_minutes" > 0 AND "appointments"."total_occupancy_minutes" >= "appointments"."total_service_minutes" AND "appointments"."subtotal_minor_units" >= 0),
	CONSTRAINT "appointments_client_reserved" CHECK ("appointments"."client_id" IS NULL),
	CONSTRAINT "appointments_cancel_state" CHECK (("appointments"."status" = 'cancelled') = ("appointments"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "appointment_addons" ADD CONSTRAINT "appointment_addons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_addons" ADD CONSTRAINT "appointment_addons_service_fk" FOREIGN KEY ("appointment_service_id","tenant_id") REFERENCES "public"."appointment_services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_addons" ADD CONSTRAINT "appointment_addons_add_on_id_tenant_id_add_ons_id_tenant_id_fk" FOREIGN KEY ("add_on_id","tenant_id") REFERENCES "public"."add_ons"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_idempotency" ADD CONSTRAINT "appointment_idempotency_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_idempotency" ADD CONSTRAINT "appointment_idempotency_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_tenant_id_services_id_tenant_id_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_variant_id_tenant_id_service_variants_id_tenant_id_fk" FOREIGN KEY ("variant_id","tenant_id") REFERENCES "public"."service_variants"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_staff_assignments" ADD CONSTRAINT "appointment_staff_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_staff_assignments" ADD CONSTRAINT "appointment_staff_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_staff_assignments" ADD CONSTRAINT "appointment_staff_assignments_staff_id_tenant_id_staff_profiles_id_tenant_id_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_history_appointment_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_tenant_id_locations_id_tenant_id_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_primary_staff_id_tenant_id_staff_profiles_id_tenant_id_fk" FOREIGN KEY ("primary_staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_history_lookup_idx" ON "appointment_status_history" USING btree ("tenant_id","appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "appointments_tenant_start_idx" ON "appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_staff_status_idx" ON "appointments" USING btree ("tenant_id","primary_staff_id","status");