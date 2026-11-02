import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ActionForm } from "@/components/auth/action-form";
import { PasswordInput } from "@/components/auth/password-input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/lib/auth/actions";

export const metadata = { title: "Reset password — ITG TraderOS" };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" subtitle="Enter a new password for your account.">
      <ActionForm action={resetPasswordAction} submitLabel="Reset password" submitClassName="itg2-btn-primary itg2-btn-save">
        <div className="itg2-field space-y-2">
          <Label htmlFor="password" className="itg2-label">New password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor="confirmPassword" className="itg2-label">Confirm new password</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
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
