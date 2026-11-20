import { Link } from 'react-router-dom';
import { EmptyState } from '../components/UI';

export default function NotFoundPage() {
  return (
    <div className="container page">
      <EmptyState title="Out of bounds" action={<Link className="btn btn-primary" to="/">Back to the leaderboard</Link>}>
        The page you’re looking for doesn’t exist.
      </EmptyState>
    </div>
  );
}
