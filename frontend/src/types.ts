export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  profileImageUrl?: string | null;
  roles: string[];
  restaurantIds: string[];
};

export type Session = {
  token: string;
  user: SessionUser;
};
