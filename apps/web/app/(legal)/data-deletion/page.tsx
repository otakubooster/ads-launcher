import type { Metadata } from "next";

export const metadata: Metadata = { title: "Data deletion" };

const contact = process.env.OWNER_EMAIL || process.env.ALERT_FROM_EMAIL || "the team that runs this app";

export default function DataDeletionPage() {
  return (
    <>
      <h1>Data deletion instructions</h1>
      <p>Fahd Ads Launcher stores no personal data about Facebook or Instagram users. It only keeps the business&apos;s own ad account data and its team members&apos; sign-in details.</p>
      <h2>To delete your data</h2>
      <ul>
        <li>
          Email <strong>{contact}</strong> and ask for your data to be deleted. We remove it within 30 days and confirm by email.
        </li>
        <li>To stop this app accessing Meta at any time, remove it from your Business Settings → Apps, or remove its system user.</li>
      </ul>
    </>
  );
}
