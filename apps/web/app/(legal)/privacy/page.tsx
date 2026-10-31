import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

const contact = process.env.OWNER_EMAIL || process.env.ALERT_FROM_EMAIL || "the team that runs this app";

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        Fahd Ads Launcher is an internal tool a single business uses to manage its own Meta (Facebook and Instagram) ad accounts. It is not offered to the public, and only
        invited team members can sign in.
      </p>
      <h2>What we access</h2>
      <ul>
        <li>The business&apos;s own ad accounts, campaigns, ad sets, ads, creatives, Pages, Instagram accounts and pixels, through a Meta system user the business controls.</li>
        <li>Ad performance numbers Meta reports (spend, impressions, clicks, purchases and similar). These are aggregated: no data about individual people who saw or clicked ads.</li>
        <li>Team members&apos; name, email and role, so they can sign in.</li>
      </ul>
      <h2>How we use it</h2>
      <p>Only to show the business its ad performance, and to create and edit its own ads when a team member asks. We don&apos;t sell, share or use the data for anything else.</p>
      <h2>Storage and security</h2>
      <p>Data is stored in the business&apos;s own database. Meta access tokens are encrypted and never sent to a browser.</p>
      <h2>Deleting data</h2>
      <p>
        See <a className="text-iris-11 underline" href="/data-deletion">data deletion instructions</a>.
      </p>
      <h2>Contact</h2>
      <p>Questions about this policy: {contact}.</p>
    </>
  );
}
