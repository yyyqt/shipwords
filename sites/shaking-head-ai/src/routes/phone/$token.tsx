import { createFileRoute } from '@tanstack/react-router';
import { PhoneUploadPage } from '~/site/phone-upload';

export const Route = createFileRoute('/phone/$token')({
  head: () => ({
    meta: [
      { title: 'Upload from phone — Shaking Head AI' },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  component: PhoneRoute,
});
function PhoneRoute() {
  return <PhoneUploadPage token={Route.useParams().token} />;
}
