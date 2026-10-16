import { Container, Card, Button } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

const Hero = () => {
  return (
    <div className='py-5'>
      <Container className='d-flex justify-content-center'>
        <Card className='p-5 d-flex flex-column align-items-center hero-card bg-light w-75 text-center shadow-sm rounded-4'>
          <div className='mb-3'>
            <span style={{ fontSize: '3.5rem', color: '#0284c7' }}>⬡</span>
          </div>
          <h1 className='mb-3 fw-bold'>MERN Authentication with Quant0</h1>
          <p className='text-muted mb-4 lead' style={{ maxWidth: '600px' }}>
            Secured by Quant0 SSO with OAuth 2.1 &amp; PKCE flow. Tokens are verified
            locally via the high-performance <code>q0-agent</code> sidecar.
          </p>
          <div className='d-flex gap-3'>
            <LinkContainer to='/login'>
              <Button variant='primary' size='lg' className='px-4'>
                Sign In
              </Button>
            </LinkContainer>
            <LinkContainer to='/register'>
              <Button variant='outline-secondary' size='lg' className='px-4'>
                Register
              </Button>
            </LinkContainer>
          </div>
        </Card>
      </Container>
    </div>
  );
};

export default Hero;
