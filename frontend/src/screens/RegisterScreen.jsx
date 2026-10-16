import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from 'react-bootstrap';
import FormContainer from '../components/FormContainer';
import { useSelector } from 'react-redux';
import { redirectToQuant0Login } from '../utils/quant0';

const RegisterScreen = () => {
  const navigate = useNavigate();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) {
      navigate('/');
    }
  }, [navigate, userInfo]);

  return (
    <FormContainer>
      <Card className='p-4 text-center shadow-sm my-4' style={{ borderRadius: '12px' }}>
        <div className='my-3'>
          <span style={{ fontSize: '3rem', color: '#0284c7' }}>⬡</span>
        </div>
        <h2 className='mb-2 fw-bold'>Create Account</h2>
        <p className='text-muted mb-4'>
          Join seamlessly using your secure Quant0 identity
        </p>

        <Button
          variant='dark'
          className='w-100 py-3 mb-3 d-flex align-items-center justify-content-center gap-2 shadow-sm'
          onClick={() => redirectToQuant0Login({ screenHint: 'signup' })}
          style={{
            borderRadius: '8px',
            fontWeight: 600,
            fontSize: '1rem',
            background: '#0f172a',
            borderColor: '#1e293b',
          }}
        >
          <span style={{ fontSize: '1.25rem', color: '#38bdf8' }}>⬡</span> Sign Up with Quant0
        </Button>

        <div className='mt-3 text-muted small'>
          Already have an account?{' '}
          <span
            className='text-primary fw-semibold'
            style={{ cursor: 'pointer' }}
            onClick={() => redirectToQuant0Login()}
          >
            Sign In
          </span>
        </div>
      </Card>
    </FormContainer>
  );
};

export default RegisterScreen;
