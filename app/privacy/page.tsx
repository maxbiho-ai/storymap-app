import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · StoryMap",
  description: "How StoryMap uses your Google sign-in and your photos' location data.",
};

const UPDATED = "25 November 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-neutral-950 px-5 py-12 text-neutral-200">
      <article className="mx-auto max-w-2xl">
        <Link href="/" className="text-xs font-black tracking-[0.25em] text-white">
          STORY<span className="text-amber-300">MAP</span>
        </Link>
        <h1 className="mt-6 text-3xl font-semibold text-white">Privacy Policy</h1>
        <p className="mt-1 text-sm text-neutral-500">Last updated {UPDATED}</p>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">What StoryMap is</h2>
            <p>
              StoryMap places every photo on the spot where it was taken, so you can keep a personal travel map and share the
              places you love. This page explains what data we use to do that, and what we never do with it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">Signing in with Google</h2>
            <p>
              When you choose <strong className="text-white">Continue with Google</strong>, we receive only your{" "}
              <strong className="text-white">email address</strong> and your <strong className="text-white">basic profile</strong> (name and
              profile picture). We use them to create your account, sign you in, and show your name as the photographer of the
              photos you upload. We never get your Google password and we do not access your Gmail, Drive, contacts or any other
              Google data. You can also sign up with an email and password instead.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">Your photos and their EXIF / GPS metadata</h2>
            <p>
              When you upload a photo, StoryMap reads its EXIF metadata: the GPS coordinates, the capture time, and camera details
              (camera, lens, aperture, shutter speed, ISO). This metadata is used <strong className="text-white">solely to display your personal travel map</strong>:
              placing the pin, showing when and in what light the photo was taken, and building trip and photo-walk suggestions.
              You can edit a photo&apos;s location, mark it private, or delete it at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">What we never do</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>We never sell your personal data or your photos.</li>
              <li>We never share your data with advertisers or data brokers.</li>
              <li>We do not use your photos or location history for advertising.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">Where the data is stored</h2>
            <p>
              Accounts and photo records are stored with our hosting providers (Supabase for the database and sign-in, and
              Cloudflare / Supabase storage for image files), only to run the service. Photos you mark as private are visible only
              to you.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-white">Deleting your data</h2>
            <p>
              You can delete any photo from its card. To delete your whole account and everything in it, contact the StoryMap
              team and we will remove it.
            </p>
          </section>
        </div>

        <Link href="/" className="mt-10 inline-block rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-amber-200">
          ← Back to the map
        </Link>
      </article>
    </main>
  );
}
