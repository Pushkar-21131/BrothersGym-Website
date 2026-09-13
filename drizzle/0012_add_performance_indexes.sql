CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "members_membership_expiry_idx" ON "members" USING btree ("membership_expiry");--> statement-breakpoint
CREATE INDEX "online_joins_razorpay_order_id_idx" ON "online_joins" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX "online_joins_branch_status_idx" ON "online_joins" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "payments_member_id_idx" ON "payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "payments_branch_id_idx" ON "payments" USING btree ("branch_id");