import { jest } from "@jest/globals";
const getUser=jest.fn();
jest.unstable_mockModule("../src/config/env.js",()=>({env:{CLERK_SECRET_KEY:"synthetic-not-used"}}));
jest.unstable_mockModule("@clerk/backend",()=>({createClerkClient:()=>({users:{getUser}})}));
const {verifyAccountConfirmationIdentity}=await import("../src/services/accountConfirmation.js");
const user={_id:"app-user",tenantId:"greenlane",clerkUserId:"user_verified",email:"member@synthetic.invalid"};
const clerk={provider:"clerk",clerkUserId:"user_verified",email:user.email};
const legacy={provider:"legacy",userId:user._id,tenantId:user.tenantId,email:user.email};
beforeEach(()=>{getUser.mockReset();getUser.mockResolvedValue({id:user.clerkUserId,primaryEmailAddressId:"primary",emailAddresses:[{id:"primary",emailAddress:user.email,verification:{status:"verified"}}]});});
test.each([clerk,legacy])("fresh verified primary permits the exact authenticated owner (%s)",async(identity)=>{expect(await verifyAccountConfirmationIdentity(identity,user)).toBe(true);expect(getUser).toHaveBeenCalledWith(user.clerkUserId);});
test.each([{...legacy,userId:"another-user"},{...legacy,tenantId:"cedar"},{...clerk,clerkUserId:"user_other"}])("mismatched owner never reaches Backend identity lookup",async(identity)=>{expect(await verifyAccountConfirmationIdentity(identity,user)).toBe(false);expect(getUser).not.toHaveBeenCalled();});
test.each(["banned","locked","unverified","changed-primary"])("fresh Clerk %s cannot be replaced by stale authenticated claims",async(mode)=>{
 const fresh=await getUser();getUser.mockClear();
 if(mode==="banned"||mode==="locked") fresh[mode]=true;
 if(mode==="unverified") fresh.emailAddresses[0].verification.status="unverified";
 if(mode==="changed-primary") fresh.emailAddresses[0].emailAddress="other@synthetic.invalid";
 getUser.mockResolvedValue(fresh);expect(await verifyAccountConfirmationIdentity(clerk,user)).toBe(false);
});
