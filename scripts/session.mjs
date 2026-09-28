export const UID='11111111-1111-1111-1111-111111111111'
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url')
const exp=Math.floor(Date.now()/1000)+99999
export const jwt=[b64({alg:'HS256',typ:'JWT'}),
  b64({sub:UID,email:'a@x.com',role:'authenticated',aud:'authenticated',
       exp,iat:Math.floor(Date.now()/1000),iss:'https://placeholder.supabase.co/auth/v1',
       app_metadata:{provider:'google'},user_metadata:{full_name:'A'}}),
  'sig'].join('.')
export const user={id:UID,email:'a@x.com',aud:'authenticated',role:'authenticated',
  app_metadata:{provider:'google'},user_metadata:{full_name:'A'},
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
  email_confirmed_at:new Date().toISOString()}
export const session={access_token:jwt,token_type:'bearer',expires_in:99999,
  expires_at:exp,refresh_token:'r-token',user,provider_token:'g-token'}
