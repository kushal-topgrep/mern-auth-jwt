import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { exchangeQuant0Code, clearQuant0Token } from '../utils/quant0';
import { setCredentials } from '../slices/authSlice';
import { Container, Card, Button, Alert } from 'react-bootstrap';
import Loader from '../components/Loader';

export default function CallbackScreen() {
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const handledRef = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in dev;
    // single-use authorization code exchange must only execute once.
    if (handledRef.current) return;
    handledRef.current = true;

    async function completeAuth() {
      try {
        // Step 1: Exchange code with Quant0 for tokens
        const tokens = await exchangeQuant0Code();
        if (!tokens?.access_token) {
          throw new Error('No access token returned by authentication provider.');
        }

        // Step 2: Establish session with backend & verify via local q0-agent sidecar
        const res = await fetch('/api/users/quant0-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: JSON.stringify({
            id_token: tokens.id_token,
            email: tokens.profile?.email,
            name: tokens.profile?.name,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const reason =
            errData.message ||
            errData.detail ||
            errData.error ||
            `Backend verification rejected token (HTTP ${res.status})`;
          throw new Error(reason);
        }

        const verifiedUser = await res.json();

        // Step 3: Commit session to Redux and navigate to home
        dispatch(setCredentials({ ...verifiedUser }));
        navigate('/');
      } catch (err) {
        console.error('Quant0 authentication failed:', err);
        clearQuant0Token();
        setError(err.message || 'Token verification failed. Access denied.');
      }
    }

    completeAuth();
  }, [dispatch, navigate]);

  if (error) {
    return (
      <Container className='py-5 d-flex justify-content-center'>
        <Card className='p-4 text-center' style={{ maxWidth: '500px', width: '100%' }}>
          <h3 className='text-danger mb-3'>Authentication Error</h3>
          <Alert variant='danger' style={{ wordBreak: 'break-word' }}>
            {error}
          </Alert>
          <Button variant='primary' onClick={() => navigate('/login')}>
            Back to Sign In
          </Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container className='py-5 d-flex justify-content-center'>
      <Card className='p-5 text-center' style={{ maxWidth: '500px', width: '100%' }}>
        <h3 className='mb-3'>Verifying Authentication...</h3>
        <p className='text-muted mb-4'>
          Validating cryptographic credentials with your q0-agent sidecar...
        </p>
        <Loader />
      </Card>
    </Container>
  );
}
