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
      <ActionForm action={resetPasswordAction} submitLabel="Reset password">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
