import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/auth/actions";

export const metadata = { title: "Forgot password — ITG TraderOS" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your email and we'll send you a reset link.">
      <ActionForm action={requestPasswordResetAction} submitLabel="Send reset link" submitClassName="itg2-btn-primary itg2-btn-save">
        <div className="itg2-field space-y-2">
          <Label htmlFor="email" className="itg2-label">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" className="itg2-input" />
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="itg2-link">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
